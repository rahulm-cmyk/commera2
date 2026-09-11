import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const sheetFields = ['order_id', 'date', 'revenue', 'currency', 'utm_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const fail = message => { throw Object.assign(new Error(message), { status: 400, statusCode: 400 }); };
const quoteTab = title => `'${title.replaceAll("'", "''")}'`;
export function sheetIdFromUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('Enter your Google Sheet link.'); }
  const id = url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/)?.[1];
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !id) fail('Enter a Google Sheets link.');
  return id;
}
export function mapSheetHeaders(headers) {
  const aliases = { order: 'order_id', order_number: 'order_id', order_no: 'order_id', order_date: 'date', total: 'revenue', order_total: 'revenue', amount: 'revenue', source: 'utm_source', medium: 'utm_medium', campaign: 'utm_campaign', campaign_id: 'utm_id', content: 'utm_content', term: 'utm_term' };
  return headers.map(header => {
    const key = String(header).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return sheetFields.includes(key) ? key : aliases[key] || '';
  });
}
export function migrateUtmSheets(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS utm_sheet_connections (
    store_id INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    credentials TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    spreadsheet_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', tab TEXT NOT NULL DEFAULT '',
    headers_json TEXT NOT NULL DEFAULT '[]', mapping_json TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 0, after_order_id INTEGER NOT NULL DEFAULT 0,
    last_synced TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', lock_until BIGINT NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS utm_sheet_exports (
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    spreadsheet_id TEXT NOT NULL, tab TEXT NOT NULL, order_id INTEGER NOT NULL,
    PRIMARY KEY(store_id, spreadsheet_id, tab, order_id)
  );`);
}

export class UtmSheetService {
  constructor(db, { env = process.env, clientFactory, request } = {}) {
    this.db = db;
    this.config = { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET,
      redirect: env.GOOGLE_SHEETS_REDIRECT_URI || (env.APP_BASE_URL ? `${env.APP_BASE_URL.replace(/\/+$/, '')}/api/integrations/google-sheets/callback` : '') };
    this.key = env.GOOGLE_SHEETS_CREDENTIALS_SECRET ? createHash('sha256').update(env.GOOGLE_SHEETS_CREDENTIALS_SECRET).digest() : null;
    this.ready = Boolean(this.key && this.config.id && this.config.secret && this.config.redirect);
    this.clientFactory = clientFactory || (() => new OAuth2Client(this.config.id, this.config.secret, this.config.redirect));
    this.request = request || (async (client, options) => (await client.request({ ...options, timeout: 20000, retry: false })).data);
    this.running = null;
  }
  row(id) { return this.db.prepare('SELECT * FROM utm_sheet_connections WHERE store_id=?').get(id); }
  status(id) {
    const row = this.row(id);
    return { available: this.ready, connected: Boolean(row?.credentials), email: row?.email || '', enabled: Boolean(row?.enabled),
      url: row?.spreadsheet_id ? `https://docs.google.com/spreadsheets/d/${row.spreadsheet_id}/edit` : '',
      title: row?.title || '', tab: row?.tab || '', lastSynced: row?.last_synced || '', error: row?.error || '', fields: sheetFields };
  }
  seal(tokens) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(tokens)), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64url')).join('.');
  }
  client(row) {
    const [iv, tag, data] = row.credentials.split('.').map(v => Buffer.from(v, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv); decipher.setAuthTag(tag);
    const tokens = JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString());
    const client = this.clientFactory(); client.setCredentials(tokens); return client;
  }
  async begin(state) {
    if (!this.ready) fail('Google Sheets connection needs administrator setup.');
    const client = this.clientFactory();
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    return { codeVerifier, url: client.generateAuthUrl({ state, access_type: 'offline', prompt: 'consent', scope: ['openid', 'email', 'https://www.googleapis.com/auth/spreadsheets'], code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256 }) };
  }
  async complete(id, code, codeVerifier) {
    if (!this.ready) fail('Google Sheets connection needs administrator setup.');
    const client = this.clientFactory();
    const { tokens } = await client.getToken({ code, codeVerifier });
    if (!tokens.refresh_token || !tokens.id_token) fail('Allow Google Sheets access to connect.');
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: this.config.id });
    const email = ticket.getPayload()?.email || '';
    this.db.prepare(`INSERT INTO utm_sheet_connections (store_id,credentials,email) VALUES (?,?,?)
      ON CONFLICT(store_id) DO UPDATE SET credentials=excluded.credentials,email=excluded.email,error=''`).run(id, this.seal({ refresh_token: tokens.refresh_token }), email);
  }
  async inspect(id, url, tab = '') {
    const row = this.row(id);
    if (!row?.credentials) fail('Connect your Google account first.');
    const spreadsheetId = sheetIdFromUrl(url), client = this.client(row);
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const metadata = await this.request(client, { url: `${base}?fields=properties.title,sheets.properties` });
    const tabs = metadata.sheets.map(s => s.properties.title);
    const selected = tab || tabs[0];
    if (!tabs.includes(selected)) fail('Choose a worksheet from this spreadsheet.');
    const data = await this.request(client, { url: `${base}/values/${encodeURIComponent(`${quoteTab(selected)}!1:1`)}` });
    const headers = data.values?.[0] || [];
    if (!headers.length) fail('Add column names to the first row of your sheet, then try again.');
    if (headers.length > 100) fail('Choose a worksheet with no more than 100 columns.');
    return { spreadsheetId, title: metadata.properties.title, tabs, tab: selected, headers, mapping: mapSheetHeaders(headers) };
  }
  async save(id, input) {
    if (this.row(id)?.lock_until > Date.now()) fail('An export is running. Try again shortly.');
    const info = await this.inspect(id, input.url, input.tab);
    if (input.headers && JSON.stringify(input.headers) !== JSON.stringify(info.headers)) fail('Your sheet columns changed. Choose the worksheet again.');
    const mapping = input.mapping || info.mapping;
    if (!Array.isArray(mapping) || mapping.length !== info.headers.length || mapping.some(f => f && !sheetFields.includes(f)) || mapping.filter(f => f === 'order_id').length !== 1) fail('Map exactly one column to Order ID.');
    const previous = this.row(id);
    const sameTarget = previous.spreadsheet_id === info.spreadsheetId && previous.tab === info.tab;
    const after = sameTarget ? previous.after_order_id : this.db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM orders WHERE store_id=?').get(id).id;
    const updated = this.db.prepare(`UPDATE utm_sheet_connections SET spreadsheet_id=?,title=?,tab=?,headers_json=?,mapping_json=?,enabled=1,after_order_id=?,error='' WHERE store_id=? AND lock_until<?`).run(info.spreadsheetId, info.title, info.tab, JSON.stringify(info.headers), JSON.stringify(mapping), after, id, Date.now());
    if (!updated.changes) fail('An export is running. Try again shortly.');
    return this.status(id);
  }
  pause(id) { this.db.prepare('UPDATE utm_sheet_connections SET enabled=0 WHERE store_id=?').run(id); return this.status(id); }
  disconnect(id) {
    if (this.row(id)?.lock_until > Date.now()) fail('An export is running. Try again shortly.');
    this.db.prepare("UPDATE utm_sheet_connections SET enabled=0,credentials='',email='',error='' WHERE store_id=?").run(id);
    return this.status(id);
  }
  async syncStore(id) {
    const now = Date.now();
    const lock = this.db.prepare('UPDATE utm_sheet_connections SET lock_until=? WHERE store_id=? AND enabled=1 AND lock_until<?').run(now + 600000, id, now);
    if (!lock.changes) return;
    try {
      const row = this.row(id), client = this.client(row), mapping = JSON.parse(row.mapping_json);
      const base = `https://sheets.googleapis.com/v4/spreadsheets/${row.spreadsheet_id}`;
      const range = quoteTab(row.tab);
      const pending = this.db.prepare(`SELECT o.id,o.order_number,o.created_at,o.total_paise,s.currency,a.data_json FROM orders o
        JOIN stores s ON s.id=o.store_id LEFT JOIN checkout_attribution a ON a.checkout_id=o.checkout_session_id AND a.store_id=o.store_id
        WHERE o.store_id=? AND o.id>? AND NOT EXISTS (SELECT 1 FROM utm_sheet_exports e WHERE e.store_id=o.store_id AND e.order_id=o.id AND e.spreadsheet_id=? AND e.tab=?) ORDER BY o.id LIMIT 20`).all(id, row.after_order_id, row.spreadsheet_id, row.tab);
      if (!pending.length) return;
      const data = await this.request(client, { url: `${base}/values/${encodeURIComponent(range)}` });
      const values = data.values || [];
      if (JSON.stringify(values[0] || []) !== row.headers_json) fail('Your sheet columns changed. Choose the sheet again to update the column matching.');
      const orderColumn = mapping.indexOf('order_id');
      const seen = new Set(values.slice(1).map(v => String(v[orderColumn] || '')));
      for (const order of pending) {
        if (!this.row(id)?.enabled) break;
        const orderId = String(order.order_number || order.id);
        if (!seen.has(orderId)) {
          const record = { ...JSON.parse(order.data_json || '{}'), order_id: orderId, date: order.created_at, revenue: order.total_paise / 100, currency: order.currency };
          await this.request(client, { method: 'POST', url: `${base}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, data: { values: [mapping.map(key => record[key] ?? '')] } });
          seen.add(orderId);
        }
        this.db.prepare('INSERT INTO utm_sheet_exports (store_id,spreadsheet_id,tab,order_id) VALUES (?,?,?,?) ON CONFLICT DO NOTHING').run(id, row.spreadsheet_id, row.tab, order.id);
      }
      this.db.prepare("UPDATE utm_sheet_connections SET last_synced=?,error='' WHERE store_id=?").run(new Date().toISOString(), id);
    } catch (error) {
      const message = error.statusCode === 400 ? error.message : 'Export failed. Check sheet access or reconnect Google. Pending orders will be retried.';
      this.db.prepare('UPDATE utm_sheet_connections SET error=? WHERE store_id=?').run(message, id);
    } finally { this.db.prepare('UPDATE utm_sheet_connections SET lock_until=0 WHERE store_id=?').run(id); }
  }
  sync() {
    if (this.running) return this.running;
    this.running = (async () => {
      if (!this.ready) return;
      for (const row of this.db.prepare('SELECT store_id FROM utm_sheet_connections WHERE enabled=1').all()) await this.syncStore(row.store_id);
    })().finally(() => { this.running = null; });
    return this.running;
  }
}
